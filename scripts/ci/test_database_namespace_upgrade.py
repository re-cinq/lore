"""Run Helm's upgrade render against a read-only, synthetic Kubernetes API."""

import json
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from urllib.parse import urlsplit


class NamespaceFixture(BaseHTTPRequestHandler):
    def do_GET(self):
        request_path = urlsplit(self.path).path
        discovery = {
            "/version": {"major": "1", "minor": "35", "gitVersion": "v1.35.0"},
            "/api": {"apiVersion": "v1", "kind": "APIVersions", "versions": ["v1"]},
            "/apis": {
                "apiVersion": "v1",
                "kind": "APIGroupList",
                "groups": [{
                    "name": "postgresql.cnpg.io",
                    "versions": [{"groupVersion": "postgresql.cnpg.io/v1", "version": "v1"}],
                    "preferredVersion": {"groupVersion": "postgresql.cnpg.io/v1", "version": "v1"},
                }],
            },
            "/api/v1": {
                "apiVersion": "v1",
                "kind": "APIResourceList",
                "groupVersion": "v1",
                "resources": [
                    {"name": "namespaces", "kind": "Namespace", "namespaced": False},
                    {"name": "secrets", "kind": "Secret", "namespaced": True},
                ],
            },
            "/apis/postgresql.cnpg.io/v1": {
                "apiVersion": "v1",
                "kind": "APIResourceList",
                "groupVersion": "postgresql.cnpg.io/v1",
                "resources": [{"name": "clusters", "kind": "Cluster", "namespaced": True}],
            },
        }
        response = discovery.get(request_path)
        if request_path == "/api/v1/namespaces/lore-floor":
            self.server.floor_lookups += 1
            response = self.server.floor_namespace
        if response is None:
            response = {
                "apiVersion": "v1", "kind": "Status", "status": "Failure",
                "reason": "NotFound", "code": 404,
            }
            self.send_response(404)
        else:
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, *args):
        pass


def check_render(server, chart, case, annotations, *, rendered, stopped=False, helm_label=True, upgrade=True, values=()):
    server.floor_namespace = None if annotations is None else {
        "apiVersion": "v1",
        "kind": "Namespace",
        "metadata": {
            "name": "lore-floor",
            "labels": {"name": "lore-floor"} if helm_label else {},
            "annotations": annotations,
        },
    }
    server.floor_lookups = 0
    command = [
        "helm", "template", "lore-databases", chart, "--namespace", "lore-db",
        "--dry-run=server", "--disable-openapi-validation",
        "--kubeconfig", "/dev/null", "--kube-apiserver", f"http://127.0.0.1:{server.server_port}",
        "--show-only", "templates/namespaces.yaml",
    ]
    if upgrade:
        command.append("--is-upgrade")
    command.extend(values)
    result = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    if not server.floor_lookups:
        raise AssertionError(f"{case}: Helm did not read the namespace fixture. {result.stderr}")
    if stopped:
        if result.returncode == 0 or "upgrade stopped to protect lore-floor" not in result.stderr:
            raise AssertionError(f"{case}: expected the upgrade guard. {result.stderr}")
    else:
        if result.returncode:
            raise AssertionError(f"{case}: Helm render failed. {result.stderr}")
        has_namespace = bool(re.search(r"^  name: lore-floor$", result.stdout, re.MULTILINE))
        if has_namespace != rendered:
            raise AssertionError(f"{case}: expected lore-floor rendered={rendered}")
    print(f"  ok: {case}")


def main(chart):
    with HTTPServer(("127.0.0.1", 0), NamespaceFixture) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            keep = {"helm.sh/resource-policy": "keep"}
            owner = {"meta.helm.sh/release-name": "lore-databases",
                     "meta.helm.sh/release-namespace": "lore-db"}
            check_render(server, chart, "unsafe legacy upgrade stops", {},
                         rendered=False, stopped=True)
            check_render(server, chart, "the same namespace does not block a fresh install",
                         {}, rendered=False, upgrade=False)
            check_render(server, chart, "legacy namespace with keep is left alone",
                         keep, rendered=False)
            check_render(server, chart, "a missing namespace is created", None, rendered=True)
            check_render(server, chart, "a namespace owned by this release is rendered",
                         owner, rendered=True)
            check_render(server, chart, "the same release name in another namespace is not adopted",
                         {**owner, "meta.helm.sh/release-namespace": "other"}, rendered=False)
            check_render(server, chart, "another release in this namespace is not adopted",
                         {**owner, "meta.helm.sh/release-name": "other"}, rendered=False)
            check_render(server, chart, "a namespace provisioned externally is left alone",
                         {}, rendered=False, helm_label=False)
            without_floor = ("--set", "secretNamespaces={lore-api,lore-ui,lore-stations}")
            check_render(server, chart, "taking lore-floor out of secretNamespaces still stops the unsafe upgrade",
                         {}, rendered=False, stopped=True, values=without_floor)
            check_render(server, chart, "taking lore-floor out of secretNamespaces with keep set renders no lore-floor",
                         keep, rendered=False, values=without_floor)
            check_render(server, chart, "a release living in lore-floor is not stopped by the upgrade guard and does not render its own namespace",
                         {}, rendered=False, values=("--namespace", "lore-floor"))
        finally:
            server.shutdown()
            worker.join()


if __name__ == "__main__":
    main(sys.argv[1])
