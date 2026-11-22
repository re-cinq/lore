package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func fakeOIDCJWT(exp time.Time, label string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payloadBytes, _ := json.Marshal(map[string]any{
		"sub": "repo:o/r:ref:refs/heads/main",
		"exp": exp.Unix(),
		"jti": label,
	})
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	sig := base64.RawURLEncoding.EncodeToString([]byte("sig-" + label))
	return header + "." + payload + "." + sig
}

func startOIDCServer(t *testing.T, expectedReqToken string, expectedAudience *string, nextToken func(call int) string) (*httptest.Server, *int) {
	t.Helper()
	var mu sync.Mutex
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("OIDC method = %s, want GET", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+expectedReqToken {
			t.Errorf("OIDC Authorization = %q, want %q", got, "Bearer "+expectedReqToken)
		}
		if got := r.URL.Query().Get("api-version"); got != "2.0" {
			t.Errorf("OIDC api-version = %q, want 2.0", got)
		}
		if expectedAudience != nil {
			if got := r.URL.Query().Get("audience"); got != *expectedAudience {
				t.Errorf("OIDC audience = %q, want %q", got, *expectedAudience)
			}
		}
		mu.Lock()
		calls++
		nth := calls
		mu.Unlock()
		tok := nextToken(nth)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"value": tok})
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func setOIDCEnv(t *testing.T, apiURL, oidcURL, reqToken string) {
	t.Helper()
	t.Setenv("LORE_API_URL", apiURL)
	t.Setenv("LORE_INGEST_TOKEN", "")
	t.Setenv("LORE_CI_AUTH", "identity")
	t.Setenv("ACTIONS_ID_TOKEN_REQUEST_URL", oidcURL+"/token?api-version=2.0")
	t.Setenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", reqToken)
}

func testReportManifest() string {
	return `list: >-
  printf '%s' '[{"id":"x::1","name":"1","file":"a.go"}]'
run: >-
  printf '%s' '{"passed":true,"covered":[]}' # {selector}
coverage_format: json
`
}

func TestIdentityTokenRequestedFromActionsWithInstallAudience(t *testing.T) {
	noRetrySleep(t)
	tok := fakeOIDCJWT(time.Now().Add(5*time.Minute), "initial")

	var mu sync.Mutex
	var authHeaders []string
	var paths []string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		paths = append(paths, r.Method+" "+r.URL.Path)
		mu.Unlock()

		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/repos/o/r/ingest-state":
			_ = json.NewEncoder(w).Encode(map[string]any{"commit": nil})
		case r.Method == http.MethodPost && r.URL.Path == "/api/repos/o/r/ingest":
			_, _ = io.WriteString(w, `{}`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/spec-links/parse":
			_ = json.NewEncoder(w).Encode(map[string]any{"links": []docLink{
				{DocPath: "specs/a/spec.md", StatementLine: intPtr(1), Path: "apps/x/a.test.ts", Line: intPtr(3)},
			}})
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer apiSrv.Close()

	expectedAud := apiSrv.URL
	oidcSrv, oidcCalls := startOIDCServer(t, "actions-req-tok", &expectedAud, func(int) string {
		return tok
	})
	setOIDCEnv(t, apiSrv.URL, oidcSrv.URL, "actions-req-tok")

	if err := runDocs(docsRepo(t), docsOptions{post: true}, io.Discard); err != nil {
		t.Fatalf("runDocs: %v", err)
	}
	if err := run(repoWithManifest(t, testReportManifest()), true, true, io.Discard); err != nil {
		t.Fatalf("run: %v", err)
	}
	var linksOut bytes.Buffer
	if err := runLinks(linksRepo(t), linksOptions{all: true}, &linksOut); err != nil {
		t.Fatalf("runLinks: %v (output=%q)", err, linksOut.String())
	}

	if *oidcCalls == 0 {
		t.Fatal("expected at least one OIDC token request to ACTIONS_ID_TOKEN_REQUEST_URL")
	}
	seen := map[string]bool{}
	for _, p := range paths {
		seen[p] = true
	}
	for _, want := range []string{"GET /api/repos/o/r/ingest-state", "POST /api/repos/o/r/ingest", "POST /api/spec-links/parse"} {
		if !seen[want] {
			t.Errorf("missing expected lore-api call %q among %v", want, paths)
		}
	}
	for i, got := range authHeaders {
		if got != "Bearer "+tok {
			t.Errorf("request %d (%s) Authorization = %q, want %q", i, paths[i], got, "Bearer "+tok)
		}
	}
}

func TestIdentityTokenRenewedWhenLessThanOneMinuteFromExpiry(t *testing.T) {
	noRetrySleep(t)
	shortTok := fakeOIDCJWT(time.Now().Add(30*time.Second), "short")
	longTok := fakeOIDCJWT(time.Now().Add(5*time.Minute), "long")

	var mu sync.Mutex
	var authHeaders []string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		authHeaders = append(authHeaders, r.Header.Get("Authorization"))
		mu.Unlock()
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]any{"commit": nil})
			return
		}
		_, _ = io.WriteString(w, `{}`)
	}))
	defer apiSrv.Close()

	expectedAud := apiSrv.URL
	oidcSrv, oidcCalls := startOIDCServer(t, "actions-req-tok", &expectedAud, func(call int) string {
		if call == 1 {
			return shortTok
		}
		return longTok
	})
	setOIDCEnv(t, apiSrv.URL, oidcSrv.URL, "actions-req-tok")

	if err := runDocs(docsRepo(t), docsOptions{post: true}, io.Discard); err != nil {
		t.Fatalf("runDocs: %v", err)
	}

	if *oidcCalls != 2 {
		t.Fatalf("OIDC token requests = %d, want 2 (renew once when <1m remains, then reuse)", *oidcCalls)
	}
	if len(authHeaders) != 6 {
		t.Fatalf("lore-api requests = %d, want 6 (GET+POST for specs, adrs, code)", len(authHeaders))
	}
	if authHeaders[0] != "Bearer "+shortTok {
		t.Errorf("request 0 Authorization = %q, want Bearer shortTok", authHeaders[0])
	}
	for i := 1; i < len(authHeaders); i++ {
		if authHeaders[i] != "Bearer "+longTok {
			t.Errorf("request %d Authorization = %q, want Bearer longTok", i, authHeaders[i])
		}
	}
}

func TestIdentityTokenRefreshedOnceOnUnauthorizedFromLoreAPI(t *testing.T) {
	t.Run("docs --post retries once on 401 with a fresh identity token", func(t *testing.T) {
		noRetrySleep(t)
		tok1 := fakeOIDCJWT(time.Now().Add(5*time.Minute), "stale-1")
		tok2 := fakeOIDCJWT(time.Now().Add(5*time.Minute), "fresh-2")

		var mu sync.Mutex
		rejectedOnce := false
		apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			reject := !rejectedOnce && r.Method == http.MethodPost && r.Header.Get("Authorization") == "Bearer "+tok1
			if reject {
				rejectedOnce = true
			}
			mu.Unlock()
			if reject {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if r.Header.Get("Authorization") != "Bearer "+tok1 && r.Header.Get("Authorization") != "Bearer "+tok2 {
				t.Errorf("unexpected Authorization %q", r.Header.Get("Authorization"))
			}
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"commit": nil})
				return
			}
			_, _ = io.WriteString(w, `{}`)
		}))
		defer apiSrv.Close()

		expectedAud := apiSrv.URL
		oidcSrv, oidcCalls := startOIDCServer(t, "actions-req-tok", &expectedAud, func(call int) string {
			if call == 1 {
				return tok1
			}
			return tok2
		})
		setOIDCEnv(t, apiSrv.URL, oidcSrv.URL, "actions-req-tok")

		if err := runDocs(docsRepo(t), docsOptions{post: true}, io.Discard); err != nil {
			t.Fatalf("runDocs: %v", err)
		}
		if *oidcCalls != 2 {
			t.Errorf("OIDC calls = %d, want 2 (initial + 1 refresh on 401)", *oidcCalls)
		}
	})

	t.Run("--post retries once on 401 with a fresh identity token", func(t *testing.T) {
		noRetrySleep(t)
		tok1 := fakeOIDCJWT(time.Now().Add(5*time.Minute), "stale-1")
		tok2 := fakeOIDCJWT(time.Now().Add(5*time.Minute), "fresh-2")

		var mu sync.Mutex
		rejectedOnce := false
		apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			reject := !rejectedOnce && r.Method == http.MethodPost && r.Header.Get("Authorization") == "Bearer "+tok1
			if reject {
				rejectedOnce = true
			}
			mu.Unlock()
			if reject {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"commit": nil})
				return
			}
			if r.Header.Get("Authorization") != "Bearer "+tok2 {
				t.Errorf("retried POST Authorization = %q, want Bearer fresh-2", r.Header.Get("Authorization"))
			}
			_, _ = io.WriteString(w, `{}`)
		}))
		defer apiSrv.Close()

		expectedAud := apiSrv.URL
		oidcSrv, oidcCalls := startOIDCServer(t, "actions-req-tok", &expectedAud, func(call int) string {
			if call == 1 {
				return tok1
			}
			return tok2
		})
		setOIDCEnv(t, apiSrv.URL, oidcSrv.URL, "actions-req-tok")

		if err := run(repoWithManifest(t, testReportManifest()), true, true, io.Discard); err != nil {
			t.Fatalf("run: %v", err)
		}
		if *oidcCalls != 2 {
			t.Errorf("OIDC calls = %d, want 2 (initial + 1 refresh on 401)", *oidcCalls)
		}
	})

	t.Run("links retries once on 401 and fails if 401 persists", func(t *testing.T) {
		noRetrySleep(t)
		tok1 := fakeOIDCJWT(time.Now().Add(5*time.Minute), "stale-1")
		tok2 := fakeOIDCJWT(time.Now().Add(5*time.Minute), "fresh-2")

		var mu sync.Mutex
		calls := 0
		apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			calls++
			nth := calls
			mu.Unlock()
			if nth == 1 {
				if r.Header.Get("Authorization") != "Bearer "+tok1 {
					t.Errorf("first links Authorization = %q, want Bearer stale-1", r.Header.Get("Authorization"))
				}
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if r.Header.Get("Authorization") != "Bearer "+tok2 {
				t.Errorf("retried links Authorization = %q, want Bearer fresh-2", r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"links": []docLink{}})
		}))
		defer apiSrv.Close()

		expectedAud := apiSrv.URL
		oidcSrv, oidcCalls := startOIDCServer(t, "actions-req-tok", &expectedAud, func(call int) string {
			if call == 1 {
				return tok1
			}
			return tok2
		})
		setOIDCEnv(t, apiSrv.URL, oidcSrv.URL, "actions-req-tok")

		var out bytes.Buffer
		if err := runLinks(linksRepo(t), linksOptions{all: true}, &out); err != nil {
			t.Fatalf("runLinks: %v", err)
		}
		if *oidcCalls != 2 {
			t.Errorf("OIDC calls = %d, want 2", *oidcCalls)
		}

		// Persistent 401 must stop after one retry with a fresh token.
		always401 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer always401.Close()

		expectedAud2 := always401.URL
		oidcSrv2, oidcCalls2 := startOIDCServer(t, "actions-req-tok", &expectedAud2, func(call int) string {
			return fakeOIDCJWT(time.Now().Add(5*time.Minute), string(rune('a'+call)))
		})
		setOIDCEnv(t, always401.URL, oidcSrv2.URL, "actions-req-tok")

		out.Reset()
		err := runLinks(linksRepo(t), linksOptions{all: true}, &out)
		if err == nil || !strings.Contains(err.Error(), "401") {
			t.Fatalf("err = %v, want 401 failure after single retry", err)
		}
		if *oidcCalls2 != 2 {
			t.Errorf("persistent-401 OIDC calls = %d, want 2 (initial + 1 retry)", *oidcCalls2)
		}
	})
}
