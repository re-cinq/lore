# Mobile Team

## Stack

React Native for both iOS and Android from a single codebase. We use Expo for build tooling and OTA updates. The app is in the `lore-mobile` repo.

Minimum supported versions: iOS 15+, Android API 28+ (Android 9).

Key dependencies: React Navigation for routing, React Query for server state, Redux Toolkit for local state.

## API Layer

All API calls go through the `platform-api` gateway. The mobile app never calls backend services directly.

**GraphQL:** Used for screens that need data from multiple domains in a single request (e.g., dashboard, account overview). Apollo Client handles caching, pagination, and optimistic updates. The GraphQL endpoint is `platform-api/graphql`, which resolves via federation to backend services.

**REST:** Used for simple CRUD operations and actions (e.g., create a payment, update profile). REST calls go through a thin wrapper in `src/api/client.ts` that handles auth headers, retry logic, and error normalization.

Auth tokens (JWT from Auth0) are stored in the device keychain (iOS) / encrypted shared preferences (Android) via `react-native-keychain`. The API client attaches the token to every request automatically.

## Offline Support

Redux Persist stores local state to AsyncStorage. When the device goes offline, mutations (writes) are queued in a local operation queue (`src/offline/queue.ts`). When connectivity returns, queued operations replay in order.

Conflict resolution is last-write-wins for most entities. For payments, we don't queue — if the user is offline, we show an error and ask them to retry when connected. Money operations should not sit in a local queue.

Network state detection uses `@react-native-community/netinfo`.

## Release Cadence

We release every 2 weeks, aligned with sprint boundaries.

**Timeline for each release:**
- Monday: code freeze, final QA on staging builds
- Tuesday: submit to App Store and Google Play
- Thursday: expect App Store approval (Google Play usually approves same day)
- Friday: phased rollout begins — 10% on day 1, 50% on day 3, 100% on day 5

Hotfixes bypass the normal cycle. OTA updates via Expo for JS-only changes; native changes require a full store submission.

## Feature Flags

LaunchDarkly for feature flags. All new features ship behind a flag. The flag naming convention is `mobile-<feature-name>` (e.g., `mobile-payment-intents`, `mobile-dark-mode`).

Flags are evaluated on app launch and cached locally. The LaunchDarkly SDK streams updates, so flag changes take effect within ~30 seconds without an app restart.

Gradual rollout pattern: internal (Acme employees) -> 10% of users -> 50% -> 100%. Each stage runs for at least 3 days unless we find issues.

Remove flags once a feature is at 100% and stable for 2 weeks. Dead flags create confusion.
