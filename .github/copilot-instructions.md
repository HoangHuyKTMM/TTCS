# Reader App - AI Agent Instructions

## Project Overview
Vietnamese e-book reader mobile app built with React Native (Expo) and Express.js backend. Three-tier architecture: mobile app (`src/`), backend server (`admin-dashboard/server/`), and admin dashboard (`admin-dashboard/frontend/`).

## Architecture & Data Flow

### Mobile App (React Native + Expo)
- **Framework**: Expo SDK 54, React Native 0.81, Expo Router v6 (file-based routing)
- **Entry point**: `src/app/_layout.tsx` - Stack navigator with nested routes
- **Route structure**: `src/app/` directory maps to screens:
  - `index.tsx` → splash/landing
  - `home.tsx` → main feed
  - `book/[id].tsx` → book details (dynamic route)
  - `reader/[id].tsx` → chapter reader
  - `(auth)/` → grouped auth routes (login, register)
  - `(tabs)/` → bottom tab navigation (explore, library, profile, etc.)

### Backend Server (Express + MySQL)
- **Location**: `admin-dashboard/server/index.js` (~3000 lines, handles ALL API endpoints)
- **Database**: MySQL (configured via `.env USE_MYSQL=true`) or fallback to `data.json`
- **Key features**:
  - Dual-mode storage: MySQL or JSON file (for local dev without DB)
  - JWT authentication with `authMiddleware`
  - File uploads via Multer (covers, banners, avatars, ad videos)
  - Static file serving: `/covers`, `/banners`, `/avatars`, `/ad-media`
  - Grok AI integration for chatbot (requires `GROK_API_KEY` in `.env`)

### API Integration
- **Base URL config**: Set in `app.json` (`extra.apiBase`) and `eas.json` env vars
- **Mobile client**: `src/lib/api.ts` - all API calls use `API_BASE` (defaults to `http://10.0.2.2:4000` for Android emulator)
- **Authentication**: JWT tokens stored in SecureStore (native) or localStorage (web) via `src/lib/auth.ts`

## Critical Development Workflows

### Running the Stack
```powershell
# Install all dependencies once
.\install_all.bat

# Start all services simultaneously (recommended)
.\run_all.bat
# → Backend: http://localhost:4000
# → Admin Dashboard: http://localhost:5173
# → Mobile: Expo DevTools (scan QR with Expo Go)

# Or run individually
.\run_server.bat      # Backend only
.\run_frontend.bat    # Admin dashboard only
.\run_mobile.bat      # Mobile app (runs 'npm start')
```

**Key behavior**: `.bat` files auto-check for `node_modules` and run `npm install` if missing. They also kill processes on ports 4000, 5173, 8081 to prevent conflicts.

### Building & Deployment
- **Development build**: `eas build --platform android --profile development` (includes dev tools, fast iteration)
- **Preview APK**: `eas build --platform android --profile preview` (production-like, no dev tools)
- **Production AAB**: `eas build --platform android --profile production` (for Google Play)
- **IMPORTANT**: After changing Firebase/Google Sign-In config, update SHA-1 fingerprint in Firebase Console and re-download `google-services.json` (see `BUILD_INSTRUCTIONS.md`)

### Database Setup
```powershell
# Create database
mysql -u root -p -e "CREATE DATABASE reader_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Import schema with seed data
mysql -u root -p reader_app < admin-dashboard/server/schema.sql

# Create admin user (after schema import)
cd admin-dashboard/server
node scripts/create_admin.js admin@example.com password123 "Admin Name"
```

**Schema structure**: `books` (stories), `chapters`, `genres`, `story_genres` (many-to-many), `users`, `comments`, `likes`, `follows`, `banners`, `ads`, `wallet_transactions`, etc.

## Project-Specific Conventions

### Authentication Pattern
- **Triple OAuth support**: Google, Facebook, Email/Password (all via Firebase Auth)
- **Native vs Web divergence**:
  - Native: Uses `@react-native-firebase/auth` + `@react-native-google-signin/google-signin`
  - Web: Uses `firebase` npm package with `signInWithPopup`
  - **Dynamic imports** in `src/lib/auth.ts` to avoid crashes in Expo Go
- **Token flow**: Firebase ID token → Backend `/auth/firebase` endpoint → JWT token → Stored in SecureStore
- **Web client ID**: Hardcoded in `src/lib/auth.ts` (line 27): `220903784873-rn1gdgqifur44r8am7a0h8mb0meh11v5.apps.googleusercontent.com`
- **Facebook App ID**: In `app.json` plugins section (`839158852294313`)

### Storage Strategy
- **Secure data**: `expo-secure-store` for tokens/auth (fallback to localStorage on web)
- **Offline reading**: Custom implementation in `src/lib/offline.ts`
  - Books stored as JSON files in `FileSystem.documentDirectory/offline/`
  - Index stored in SecureStore key `reader_app_offline_index_v1`
  - Chapters bundled with book data for offline access
- **Reading progress**: `src/lib/reading.ts` tracks last chapter/position per book in SecureStore

### Backend API Patterns
- **Auth middleware**: `authMiddleware` function extracts JWT from `Authorization: Bearer <token>` header
- **File upload endpoints**: Use Multer middleware, return relative URL (e.g., `/covers/filename.jpg`)
  - Book covers: `POST /books/upload` (multipart form)
  - Banners: `POST /banners` with `bannerUpload.single('banner')`
  - Ad videos: `POST /ads` with `adVideoUpload.single('video')`
- **Dual storage check**: Every DB operation checks `useMysql` flag to route to MySQL or `data.json`
- **Text body coercion**: Custom middleware detects JSON in text bodies (for clients that don't set `Content-Type`)

### Environment Configuration
- **Backend `.env`** (`admin-dashboard/server/.env`):
  ```env
  USE_MYSQL=true
  MYSQL_HOST=localhost
  MYSQL_USER=root
  MYSQL_PASSWORD=yourpassword
  MYSQL_DATABASE=reader_app
  JWT_SECRET=your_secret_key
  GROK_API_KEY=xai-your-key-here
  ADMIN_REG_SECRET=secret_for_registration
  ```
- **Mobile app config**:
  - `app.json` → `extra.apiBase` (for local development)
  - `eas.json` → `env.EXPO_PUBLIC_API_BASE` (per build profile)
  - Runtime priority: `EXPO_PUBLIC_API_BASE` env var > `app.json` extra.apiBase > hardcoded default

### Code Organization
- **No shared component library**: Components live in `src/components/` (AdBanner, AdInterstitial, CustomAlert, QRPaymentModal)
- **API helpers centralized**: `src/lib/api.ts` exports ~40 functions (all prefixed `api*`)
- **Type safety**: TypeScript strict mode, types defined in `src/types/` (not shown in structure, infer from code)
- **No state management library**: Uses React Context + local state (check `src/app/_layout.tsx` for auth context patterns)

## Integration Points

### Firebase Services
- **Auth**: Email/password, Google OAuth, Facebook Login
- **Config files**:
  - `google-services.json` (root + `android/app/`) - download from Firebase Console after SHA-1 setup
  - `src/lib/firebase.ts` - web config with hardcoded `firebaseConfig`
- **Package name**: `com.dinhhung1508.readerapp` (must match across Firebase, `app.json`, `android/app/build.gradle`)

### External APIs
- **Grok AI**: Used in chatbot feature (`src/app/chatbot.tsx`)
  - Backend proxy endpoint (not visible in first 150 lines, likely around line 2500+)
  - Requires `GROK_API_KEY` in server `.env`

### Payment Integration
- **Custom wallet system**: In-app coins stored in `wallet` table
- **Top-up flow**: User creates request → admin approves → coins credited
- **QR payment modal**: `src/components/QRPaymentModal.tsx` (likely for manual payment proof upload)

## Common Pitfalls

1. **API_BASE misconfiguration**: Mobile app defaults to `10.0.2.2:4000` (Android emulator). For physical devices, set IP in `app.json` extra.apiBase or `eas.json` env vars.

2. **Firebase SHA-1 changes**: When building new APK, SHA-1 fingerprint changes → Google Sign-In breaks. Always update Firebase Console and re-download `google-services.json`.

3. **Port conflicts**: `.bat` scripts kill processes on 4000, 5173, 8081 but may fail if admin cmd not available. Manually kill: `Get-Process | Where-Object {$_.Name -eq "node"} | Stop-Process -Force`

4. **MySQL vs JSON mode**: Backend silently uses `data.json` if `USE_MYSQL` not set. Check console logs for "MySQL mode enabled" on startup.

5. **Dynamic imports**: `src/lib/auth.ts` uses `await import()` for native modules to support web. Never use static imports for `@react-native-firebase/*` or `@react-native-google-signin/*` at top level.

6. **File upload size limits**: Backend has 20MB limit for JSON bodies (covers as base64) and 120MB for ad videos. Adjust in `express.json({ limit: '20mb' })` and `multer` config.

## Testing & Debugging

- **Backend logs**: Server logs all requests with timestamp `[${new Date().toISOString()}] ${req.method} ${req.url}`
- **Mobile API logs**: Every fetch in `src/lib/api.ts` logs URL before request
- **Development client required**: Native modules (Firebase, Google Sign-In) only work in development builds, NOT Expo Go. Run `npm run android` or use EAS build.
- **Admin dashboard**: Login at `http://localhost:5173/login.html` (JWT stored in `localStorage.admin_token`)

## Quick Reference

- **Package manager**: npm (not yarn, not pnpm)
- **Node version**: Implied Node.js 18+ (check `package.json` engines if added)
- **Database schema**: `admin-dashboard/server/schema.sql`
- **Main server file**: `admin-dashboard/server/index.js` (all endpoints in one file)
- **Mobile routes**: `src/app/` directory = screen routes
- **Static assets**: Served from `admin-dashboard/server/public/` → accessible at `http://localhost:4000/<folder>/<file>`
