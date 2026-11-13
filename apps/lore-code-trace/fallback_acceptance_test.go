package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestDeltaFlowFailsOutrightWhenTheAPIIsAbsent(t *testing.T) {
	// A server that mimics a lore-api which predates incremental routes (returns 404)
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer apiSrv.Close()

	webhookHit := false
	hookSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		webhookHit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer hookSrv.Close()

	os.Setenv("LORE_API_URL", apiSrv.URL)
	os.Setenv("LORE_WEBHOOK_URL", hookSrv.URL)
	os.Setenv("LORE_INGEST_TOKEN", "tok")
	defer os.Unsetenv("LORE_API_URL")
	defer os.Unsetenv("LORE_WEBHOOK_URL")
	defer os.Unsetenv("LORE_INGEST_TOKEN")

	dir := repoWithManifest(t, `list: "printf '%s' '[{\"id\":\"x::1\",\"name\":\"1\",\"file\":\"a.go\"}]'"
run: "printf '%s' '{\"passed\":true,\"covered\":[]}' # {selector}"
coverage_format: json
`)

	var out bytes.Buffer
	// post=true triggers the delta flow which used to fallback on 404.
	err := run(dir, true, false, &out)

	if err == nil {
		t.Fatal("expected run() to fail outright when the incremental route is absent")
	}

	if webhookHit {
		t.Error("run() fell back to the chunked webhook, but the pod path is retired")
	}

	if strings.Contains(err.Error(), "falling back") {
		t.Errorf("error mentions falling back, which should be retired: %v", err)
	}
}
