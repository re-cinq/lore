import { describe, it, expect } from "vitest";
import {
  kubeConfigSource,
  loadKube,
  type KubeConfigLoader,
} from "./kube-config.js";

/** A real KubeConfigLoader that records how it was loaded instead of touching a cluster. */
class RecordingLoader implements KubeConfigLoader {
  loaded: string | null = null;

  loadFromCluster(): void {
    this.loaded = "cluster";
  }
  loadFromFile(file: string): void {
    this.loaded = `file:${file}`;
  }
  loadFromDefault(): void {
    this.loaded = "default";
  }
}

describe("kubeConfigSource", () => {
  it("returns cluster when KUBERNETES_SERVICE_HOST is set", () => {
    expect(kubeConfigSource({ KUBERNETES_SERVICE_HOST: "10.96.0.1" })).toEqual({
      kind: "cluster",
    });
  });

  it("returns the LORE_KUBECONFIG path when running outside a cluster", () => {
    expect(
      kubeConfigSource({ LORE_KUBECONFIG: "/home/dev/.kube/minikube" }),
    ).toEqual({ kind: "file", path: "/home/dev/.kube/minikube" });
  });

  it("returns default when neither KUBERNETES_SERVICE_HOST nor LORE_KUBECONFIG is set", () => {
    expect(kubeConfigSource({})).toEqual({ kind: "default" });
  });

  it("returns cluster when KUBERNETES_SERVICE_HOST and LORE_KUBECONFIG are both set", () => {
    expect(
      kubeConfigSource({
        KUBERNETES_SERVICE_HOST: "10.96.0.1",
        LORE_KUBECONFIG: "/home/dev/.kube/minikube",
      }),
    ).toEqual({ kind: "cluster" });
  });

  it("returns default when LORE_KUBECONFIG is set but empty", () => {
    expect(kubeConfigSource({ LORE_KUBECONFIG: "" })).toEqual({
      kind: "default",
    });
  });
});

describe("loadKube", () => {
  it("loads from the cluster service account when KUBERNETES_SERVICE_HOST is set", () => {
    const loader = new RecordingLoader();

    loadKube(loader, { KUBERNETES_SERVICE_HOST: "10.96.0.1" });

    expect(loader.loaded).toBe("cluster");
  });

  it("loads from the LORE_KUBECONFIG file when running outside a cluster", () => {
    const loader = new RecordingLoader();

    loadKube(loader, { LORE_KUBECONFIG: "/home/dev/.kube/minikube" });

    expect(loader.loaded).toBe("file:/home/dev/.kube/minikube");
  });

  it("loads from the ambient default when no cluster and no override", () => {
    const loader = new RecordingLoader();

    loadKube(loader, {});

    expect(loader.loaded).toBe("default");
  });
});
