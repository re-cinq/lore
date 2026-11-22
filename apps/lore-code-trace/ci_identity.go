package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// identityRenewWindow is how close to expiry a held identity token stops being
// reused: under a minute left and the next request asks for a fresh one.
const identityRenewWindow = time.Minute

// identitySource requests GitHub Actions OIDC identity tokens for one audience
// (the Lore install address) and holds the current one until it nears expiry.
type identitySource struct {
	requestURL   string
	requestToken string
	audience     string
	client       *http.Client
	now          func() time.Time

	mu    sync.Mutex
	token string
	exp   time.Time
}

func newIdentitySource(requestURL, requestToken, audience string, client *http.Client) *identitySource {
	return &identitySource{requestURL: requestURL, requestToken: requestToken, audience: audience, client: client, now: time.Now}
}

// Token returns the held token while at least a minute remains, else a new one.
func (s *identitySource) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && s.exp.Sub(s.now()) >= identityRenewWindow {
		return s.token, nil
	}
	return s.fetchLocked(ctx)
}

// Refresh discards the held token and requests a new one, for a 401 retry.
func (s *identitySource) Refresh(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fetchLocked(ctx)
}

func (s *identitySource) fetchLocked(ctx context.Context) (string, error) {
	u, err := url.Parse(s.requestURL)
	if err != nil {
		return "", fmt.Errorf("ACTIONS_ID_TOKEN_REQUEST_URL: %w", err)
	}
	q := u.Query()
	q.Set("audience", s.audience)
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.requestToken)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("requesting identity token: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("requesting identity token: HTTP %d", resp.StatusCode)
	}
	var body struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body.Value == "" {
		return "", fmt.Errorf("requesting identity token: no token in response")
	}
	exp, err := jwtExpiry(body.Value)
	if err != nil {
		return "", err
	}
	s.token, s.exp = body.Value, exp
	return s.token, nil
}

// jwtExpiry reads the exp claim of a JWT without verifying it: the audience
// verifies the signature, the client only needs to know when to renew.
func jwtExpiry(jwt string) (time.Time, error) {
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		return time.Time{}, fmt.Errorf("identity token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, fmt.Errorf("identity token payload: %w", err)
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Exp == 0 {
		return time.Time{}, fmt.Errorf("identity token has no exp claim")
	}
	return time.Unix(claims.Exp, 0), nil
}

// identityTransport signs every request to lore-api with the current identity
// token and, on a 401, replays the request once with a freshly requested one.
type identityTransport struct {
	source *identitySource
	next   http.RoundTripper
}

// identityTransportFromEnv answers the transport that signs requests with an
// Actions identity token when LORE_CI_AUTH is "identity", and nil otherwise:
// the client never picks its credential by whether Actions offers the request
// URL (FR-451). Identity mode without what it needs is an error, not a silent
// fall back to the stored token.
func identityTransportFromEnv(apiBase string) (http.RoundTripper, error) {
	if os.Getenv("LORE_CI_AUTH") != "identity" {
		return nil, nil
	}
	reqURL := os.Getenv("ACTIONS_ID_TOKEN_REQUEST_URL")
	reqToken := os.Getenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
	if reqURL == "" || reqToken == "" || apiBase == "" {
		return nil, fmt.Errorf("LORE_CI_AUTH=identity requires LORE_API_URL, ACTIONS_ID_TOKEN_REQUEST_URL and ACTIONS_ID_TOKEN_REQUEST_TOKEN (grant the job id-token: write)")
	}
	return &identityTransport{
		source: newIdentitySource(reqURL, reqToken, apiBase, &http.Client{Timeout: time.Minute}),
		next:   http.DefaultTransport,
	}, nil
}

func (t *identityTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	token, err := t.source.Token(req.Context())
	if err != nil {
		return nil, err
	}
	resp, err := t.next.RoundTrip(withBearer(req, token))
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		return resp, err
	}
	retry := req
	if req.Body != nil && req.Body != http.NoBody {
		if req.GetBody == nil {
			return resp, nil
		}
		body, err := req.GetBody()
		if err != nil {
			return resp, nil
		}
		retry = req.Clone(req.Context())
		retry.Body = body
	}
	fresh, err := t.source.Refresh(req.Context())
	if err != nil {
		return resp, nil
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return t.next.RoundTrip(withBearer(retry, fresh))
}

func withBearer(req *http.Request, token string) *http.Request {
	r := req.Clone(req.Context())
	r.Header.Set("Authorization", "Bearer "+token)
	return r
}
