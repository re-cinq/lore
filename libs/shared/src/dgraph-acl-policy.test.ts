import { describe, it, expect } from "vitest";
import { auditDgraphAcl } from "./dgraph-acl-policy.js";

describe("auditDgraphAcl", () => {
  it("returns no violations for no documents", () => {
    expect(auditDgraphAcl([])).toEqual([]);
  });

  it("flags a container env that hardcodes a credential value", () => {
    const hardcodedDoc = {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: { name: "dgraph-alpha" },
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "alpha",
                env: [
                  { name: "DGRAPH_ACL_SECRET", value: "supersecret-guardian-pw" },
                ],
              },
            ],
          },
        },
      },
    };

    const violations = auditDgraphAcl([hardcodedDoc]);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(" ")).toMatch(/hardcoded|literal|DGRAPH_ACL_SECRET/i);
  });

  it("flags a dgraph alpha workload whose args do not enable --acl", () => {
    const alphaNoAcl = {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: { name: "dgraph-alpha" },
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "alpha",
                command: ["dgraph", "alpha"],
                args: ["--my", "lore-memory", "--zero", "dgraph-zero:5080"],
              },
            ],
          },
        },
      },
    };

    const violations = auditDgraphAcl([alphaNoAcl]);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(" ")).toMatch(/acl/i);
  });

  it("flags a runtime StatefulSet that references the guardian credential", () => {
    const runtimeUsesGuardian = {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: { name: "dgraph-alpha" },
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "alpha",
                command: ["dgraph", "alpha"],
                args: ["--acl", "secret-file=/acl/hmac"],
                env: [
                  {
                    name: "DGRAPH_GUARDIAN_PASSWORD",
                    valueFrom: { secretKeyRef: { name: "dgraph-guardian", key: "password" } },
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const violations = auditDgraphAcl([runtimeUsesGuardian]);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(" ")).toMatch(/guardian/i);
  });

  it("flags a ServiceAccount missing the Workload Identity annotation", () => {
    const saNoWi = {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: "lore-memory-app", namespace: "lore-memory" },
    };

    const violations = auditDgraphAcl([saNoWi]);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(" ")).toMatch(/workload identity|iam\.gke\.io|gcp-service-account/i);
  });

  it("returns no violations for a fully compliant Dgraph deployment set", () => {
    const compliant = [
      {
        apiVersion: "v1",
        kind: "ServiceAccount",
        metadata: {
          name: "lore-memory-app",
          namespace: "lore-memory",
          annotations: { "iam.gke.io/gcp-service-account": "lore-memory-app@proj.iam.gserviceaccount.com" },
        },
      },
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "dgraph-alpha" },
        spec: { template: { spec: { containers: [
          { name: "alpha", command: ["dgraph", "alpha"], args: ["--acl", "secret-file=/acl/hmac"],
            env: [
              { name: "DGRAPH_APP_PASSWORD", valueFrom: { secretKeyRef: { name: "lore-memory-app", key: "password" } } },
            ] },
        ] } } },
      },
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "dgraph-acl-bootstrap", annotations: { "helm.sh/hook": "pre-install" } },
        spec: { template: { spec: { containers: [
          { name: "bootstrap", command: ["sh", "-c", "set-acl"],
            env: [
              { name: "DGRAPH_GUARDIAN_PASSWORD", valueFrom: { secretKeyRef: { name: "dgraph-guardian", key: "password" } } },
            ] },
        ] } } },
      },
    ];

    expect(auditDgraphAcl(compliant)).toEqual([]);
  });

  it("does not flag a secretKeyRef env (no literal value) as a hardcoded credential", () => {
    const usesSecretRef = {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: { name: "dgraph-alpha" },
      spec: { template: { spec: { containers: [
        { name: "alpha", command: ["dgraph", "alpha"], args: ["--acl", "secret-file=/acl/hmac"],
          env: [{ name: "DGRAPH_APP_SECRET", valueFrom: { secretKeyRef: { name: "lore-memory-app", key: "secret" } } }] },
      ] } } },
    };

    expect(auditDgraphAcl([usesSecretRef])).toEqual([]);
  });

  it("does not flag the pre-install bootstrap Job for using the guardian credential", () => {
    const bootstrap = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: "dgraph-acl-bootstrap", annotations: { "helm.sh/hook": "pre-install" } },
      spec: { template: { spec: { containers: [
        { name: "bootstrap",
          env: [{ name: "DGRAPH_GUARDIAN_PASSWORD", valueFrom: { secretKeyRef: { name: "dgraph-guardian", key: "password" } } }] },
      ] } } },
    };

    expect(auditDgraphAcl([bootstrap])).toEqual([]);
  });
});
