import { describe, it, expect } from "vitest";
import { buildLoreTaskJob, KERNEL_IMAGE, type LoreTaskJobInput } from "./job-builder.js";

const baseInput: LoreTaskJobInput = {
  spec: {
    taskId: "abcdef12-3456",
    taskType: "implementation",
    targetRepo: "re-cinq/lore",
    prompt: "do the thing",
    description: "do the thing",
    branch: "lore/impl/x",
  },
  namespace: "lore-floor",
  tokenSecretName: "loretask-github-token-abcdef12",
  ingestUrl: "https://lore-api.example.com",
};

function containers(job: ReturnType<typeof buildLoreTaskJob>) {
  return job.spec?.template.spec?.containers ?? [];
}
function initContainers(job: ReturnType<typeof buildLoreTaskJob>) {
  return job.spec?.template.spec?.initContainers ?? [];
}

describe("buildLoreTaskJob — default (no BYO image)", () => {
  it("produces a single kernel container, no sidecar, no shared volume", () => {
    const job = buildLoreTaskJob(baseInput);
    const cs = containers(job);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ name: "claude-runner", image: KERNEL_IMAGE });
    expect(initContainers(job)).toHaveLength(0);
    expect(job.spec?.template.spec?.volumes ?? []).toHaveLength(0);
  });

  it("treats an explicit default image the same as no image (single container)", () => {
    const job = buildLoreTaskJob({
      ...baseInput,
      spec: { ...baseInput.spec, image: KERNEL_IMAGE },
    });
    expect(containers(job)).toHaveLength(1);
    expect(initContainers(job)).toHaveLength(0);
  });
});

describe("buildLoreTaskJob — BYO toolchain image (sidecar)", () => {
  const job = buildLoreTaskJob({
    ...baseInput,
    spec: { ...baseInput.spec, image: "golang:1.23" },
  });

  it("keeps the kernel container on our image (log compatibility)", () => {
    const kernel = containers(job).find((c) => c.name === "claude-runner");
    expect(kernel?.image).toBe(KERNEL_IMAGE);
  });

  it("adds the BYO image as a native sidecar running the relay", () => {
    const toolchain = initContainers(job).find((c) => c.name === "toolchain");
    expect(toolchain?.image).toBe("golang:1.23");
    expect(toolchain?.restartPolicy).toBe("Always"); // k8s native sidecar
    expect(toolchain?.command?.[0]).toBe("/bin/sh");
    expect(toolchain?.command?.join(" ")).toContain("LORE_RELAY_DIR");
  });

  it("shares a workspace volume between kernel and toolchain", () => {
    const vols = job.spec?.template.spec?.volumes ?? [];
    expect(vols.find((v) => v.name === "workspace")?.emptyDir).toBeDefined();
    const kernel = containers(job).find((c) => c.name === "claude-runner");
    const toolchain = initContainers(job).find((c) => c.name === "toolchain");
    for (const c of [kernel, toolchain]) {
      expect(c?.volumeMounts?.find((m) => m.name === "workspace")?.mountPath).toBe(
        "/workspace",
      );
    }
  });

  it("tells the kernel where the relay is via LORE_TOOLCHAIN_RELAY", () => {
    const kernel = containers(job).find((c) => c.name === "claude-runner");
    const relay = kernel?.env?.find((e) => e.name === "LORE_TOOLCHAIN_RELAY");
    expect(relay?.value).toBe("/workspace/.lore/relay");
  });

  it("gives the toolchain sidecar a writable HOME on the shared volume", () => {
    const toolchain = initContainers(job).find((c) => c.name === "toolchain");
    const home = toolchain?.env?.find((e) => e.name === "HOME");
    expect(home?.value).toBe("/workspace/.home");
  });
});
