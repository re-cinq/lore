package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// lore:validates specs/machine-callers-own-credentials/spec.md#FR-270
func TestIdentitySourceReusesTokenUntilUnderOneMinuteThenRenews(t *testing.T) {
	now := time.Now()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if got := r.URL.Query().Get("audience"); got != "https://lore.example" {
			t.Errorf("audience = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"value": fakeOIDCJWT(now.Add(90*time.Second), string(rune('a'+calls)))})
	}))
	defer srv.Close()

	s := newIdentitySource(srv.URL+"/t?api-version=2.0", "req", "https://lore.example", srv.Client())
	s.now = func() time.Time { return now }
	first, err := s.Token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	again, _ := s.Token(context.Background())
	if again != first || calls != 1 {
		t.Fatalf("expected reuse with 90s left; calls=%d", calls)
	}
	s.now = func() time.Time { return now.Add(31 * time.Second) }
	renewed, _ := s.Token(context.Background())
	if renewed == first || calls != 2 {
		t.Fatalf("expected renewal with 59s left; calls=%d", calls)
	}
}

func setActionsEndpoint(t *testing.T, ciAuth string) {
	t.Helper()
	t.Setenv("LORE_CI_AUTH", ciAuth)
	t.Setenv("ACTIONS_ID_TOKEN_REQUEST_URL", "https://actions.example/token?api-version=2.0")
	t.Setenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "request-token")
}

func TestIdentityTransportIsNilWhenLoreCIAuthIsTokenEvenWithActionsEndpoint(t *testing.T) {
	setActionsEndpoint(t, "token")
	t.Setenv("LORE_INGEST_TOKEN", "stored-ci-token")

	transport, err := identityTransportFromEnv("https://lore.example")

	if transport != nil || err != nil {
		t.Fatalf("transport = %v, err = %v, want nil and nil", transport, err)
	}
}

func TestIdentityTransportIsNilWhenLoreCIAuthIsUnsetEvenWithActionsEndpoint(t *testing.T) {
	setActionsEndpoint(t, "")
	t.Setenv("LORE_INGEST_TOKEN", "")

	transport, err := identityTransportFromEnv("https://lore.example")

	if transport != nil || err != nil {
		t.Fatalf("transport = %v, err = %v, want nil and nil", transport, err)
	}
}

func TestIdentityTransportIsUsedWhenLoreCIAuthIsIdentity(t *testing.T) {
	setActionsEndpoint(t, "identity")

	transport, err := identityTransportFromEnv("https://lore.example")

	if _, ok := transport.(*identityTransport); !ok || err != nil {
		t.Fatalf("transport = %T, err = %v, want an identityTransport", transport, err)
	}
}

func TestIdentityTransportRefusesWhenLoreCIAuthIsIdentityAndActionsOffersNoEndpoint(t *testing.T) {
	setActionsEndpoint(t, "identity")
	t.Setenv("ACTIONS_ID_TOKEN_REQUEST_URL", "")

	transport, err := identityTransportFromEnv("https://lore.example")

	if transport != nil || err == nil || !strings.Contains(err.Error(), "LORE_CI_AUTH=identity") {
		t.Fatalf("transport = %v, err = %v, want an error naming LORE_CI_AUTH=identity", transport, err)
	}
}

func TestIdentitySourceReturnsNoTokenAndCachesNothingForABadActionsAnswer(t *testing.T) {
	now := time.Now()
	good := fakeOIDCJWT(now.Add(5*time.Minute), "good")
	cases := []struct {
		name   string
		status int
		body   string
	}{
		{"non-200 status", http.StatusInternalServerError, `{"value":"` + good + `"}`},
		{"empty value", http.StatusOK, `{"value":""}`},
		{"token that is not a JWT", http.StatusOK, `{"value":"not-a-jwt"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bad := true
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if bad {
					w.WriteHeader(tc.status)
					_, _ = io.WriteString(w, tc.body)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]string{"value": good})
			}))
			defer srv.Close()
			s := newIdentitySource(srv.URL+"/t", "req", "https://lore.example", srv.Client())
			s.now = func() time.Time { return now }

			token, err := s.Token(context.Background())
			bad = false
			later, laterErr := s.Token(context.Background())

			if token != "" || err == nil || later != good || laterErr != nil {
				t.Fatalf("token = %q, err = %v; later = %q, laterErr = %v; want an error and no token, then the good one", token, err, later, laterErr)
			}
		})
	}
}

func TestIdentityTransportReturnsTheOriginal401WhenTheRefreshFails(t *testing.T) {
	now := time.Now()
	oidcCalls := 0
	oidc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		oidcCalls++
		if oidcCalls > 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"value": fakeOIDCJWT(now.Add(5*time.Minute), "first")})
	}))
	defer oidc.Close()
	loreCalls := 0
	lore := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		loreCalls++
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer lore.Close()
	transport := &identityTransport{
		source: newIdentitySource(oidc.URL+"/t", "req", lore.URL, oidc.Client()),
		next:   http.DefaultTransport,
	}
	req, _ := http.NewRequest(http.MethodGet, lore.URL+"/api/x", nil)

	resp, err := transport.RoundTrip(req)

	if err != nil || resp == nil || resp.StatusCode != http.StatusUnauthorized || loreCalls != 1 {
		t.Fatalf("resp = %v, err = %v, lore calls = %d; want the original 401, no error, one request", resp, err, loreCalls)
	}
	resp.Body.Close()
}

func TestStaticIngestTokenIsSentAsBearerWhenLoreCIAuthIsUnset(t *testing.T) {
	assertStoredTokenSentByEveryCommand(t, "", false)
}

func TestStoredCITokenIsSentAsBearerAndActionsNeverCalledWhenLoreCIAuthIsTokenWithActionsEndpoint(t *testing.T) {
	assertStoredTokenSentByEveryCommand(t, "token", true)
}

func assertStoredTokenSentByEveryCommand(t *testing.T, ciAuth string, actionsOffered bool) {
	t.Helper()
	noRetrySleep(t)
	var mu sync.Mutex
	actionsCalls := 0
	actions := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		actionsCalls++
		mu.Unlock()
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer actions.Close()
	headers := map[string][]string{}
	lore := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		headers[r.URL.Path] = append(headers[r.URL.Path], r.Header.Get("Authorization"))
		mu.Unlock()
		switch r.URL.Path {
		case "/api/repos/o/r/ingest-state":
			_ = json.NewEncoder(w).Encode(map[string]any{"commit": nil})
		case "/api/spec-links/parse":
			_ = json.NewEncoder(w).Encode(map[string]any{"links": []docLink{}})
		default:
			_, _ = io.WriteString(w, `{}`)
		}
	}))
	defer lore.Close()
	t.Setenv("LORE_API_URL", lore.URL)
	t.Setenv("LORE_INGEST_TOKEN", "stored-token")
	t.Setenv("LORE_CI_AUTH", ciAuth)
	t.Setenv("ACTIONS_ID_TOKEN_REQUEST_URL", "")
	t.Setenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
	if actionsOffered {
		t.Setenv("ACTIONS_ID_TOKEN_REQUEST_URL", actions.URL+"/token?api-version=2.0")
		t.Setenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "request-token")
	}

	docsErr := runDocs(docsRepo(t), docsOptions{post: true}, io.Discard)
	runErr := run(repoWithManifest(t, testReportManifest()), true, true, io.Discard)
	linksErr := runLinks(linksRepo(t), linksOptions{all: true}, &bytes.Buffer{})

	if docsErr != nil || runErr != nil || linksErr != nil {
		t.Fatalf("docs = %v, run = %v, links = %v", docsErr, runErr, linksErr)
	}
	for _, path := range []string{"/api/repos/o/r/ingest-state", "/api/repos/o/r/ingest", "/api/spec-links/parse"} {
		for _, got := range headers[path] {
			if got != "Bearer stored-token" {
				t.Errorf("%s Authorization = %q, want Bearer stored-token", path, got)
			}
		}
		if len(headers[path]) == 0 {
			t.Errorf("no request reached %s", path)
		}
	}
	if actionsCalls != 0 {
		t.Errorf("Actions identity endpoint called %d times, want 0", actionsCalls)
	}
}

func TestIdentityTransportDoesNotRetryAn401WhenTheBodyCannotBeReplayed(t *testing.T) {
	now := time.Now()
	tokenCalls := 0
	actions := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		tokenCalls++
		_ = json.NewEncoder(w).Encode(map[string]string{"value": fakeOIDCJWT(now.Add(time.Hour), "a")})
	}))
	defer actions.Close()
	loreCalls := 0
	lore := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		loreCalls++
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer lore.Close()

	transport := &identityTransport{
		source: newIdentitySource(actions.URL+"/t?api-version=2.0", "req", lore.URL, actions.Client()),
		next:   http.DefaultTransport,
	}
	req, _ := http.NewRequest(http.MethodPost, lore.URL, io.NopCloser(strings.NewReader("payload")))
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("err = %v, want the 401 response itself", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized || loreCalls != 1 || tokenCalls != 1 {
		t.Fatalf("status = %d, lore calls = %d, token calls = %d, want 401, 1, 1", resp.StatusCode, loreCalls, tokenCalls)
	}
}
