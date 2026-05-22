# AlertLedger Engine
### Event-Triggered SMS Alert & Ledger System for Uganda Schools & Businesses

A hyper-lightweight, mobile-first, multi-tenant platform for bulk SMS alerts.
Runs on any $5 VPS. Loads on 3G in under 2 seconds.

---

## Tech Stack
| Layer     | Choice                              |
|-----------|-------------------------------------|
| Backend   | Node.js 18+ with Express            |
| Database  | SQLite (dev) → PostgreSQL (prod)    |
| Frontend  | Single HTML file, Tailwind CSS CDN, Vanilla JS |
| SMS       | EgoSMS / Africa's Talking (pluggable) |

---

## Quick Start

### 1. Install
```bash
git clone <repo> alertledger && cd alertledger
npm install
cp .env.example .env        # edit with your SMS credentials
```

### 2. Configure `.env`
```env
PORT=3000
SMS_SIMULATE=true           # set false for live SMS
SMS_PROVIDER=egosms         # or africastalking
SMS_API_KEY=your_key
SMS_API_SECRET=your_secret
SMS_SENDER_ID=YourSchool
```

### 3. Run
```bash
# Development (SMS simulated, auto-restart on change)
npm run dev

# Production
node server.js
```

Open: **http://localhost:3000**  
Default login: `admin` / `Admin@1234`

---

## Project Structure
```
alertledger/
├── server.js                      # Express entry point
├── package.json
├── .env.example
├── alertledger.db                 # Auto-created on first run
│
├── backend/
│   ├── db/
│   │   ├── schema.sql             # Tables, indexes, triggers, seed user
│   │   └── index.js               # DB connection + query helpers
│   ├── middleware/
│   │   ├── auth.js                # Session create/validate/destroy
│   │   └── sanitize.js            # XSS strip, phone normalizer, field validator
│   ├── controllers/
│   │   ├── authController.js      # Login, register, logout, /me
│   │   ├── recordsController.js   # CRUD + bulk insert
│   │   ├── uploadController.js    # CSV/Excel parser (Feature A)
│   │   └── smsController.js       # Alerts, debt blast, DSR callback (B/C/D)
│   ├── routes/
│   │   └── index.js               # All route declarations
│   └── services/
│       └── smsGateway.js          # Provider-agnostic SMS dispatch module
│
├── frontend/
│   └── index.html                 # Complete SPA (auth + dashboard + upload + logs)
│
└── uploads/                       # Temp file storage (auto-cleaned after parse)
```

---

## API Reference

### Auth
| Method | Endpoint           | Body / Notes                          |
|--------|--------------------|---------------------------------------|
| POST   | `/api/auth/login`    | `{ username, password }`            |
| POST   | `/api/auth/register` | `{ username, password, institution_name }` |
| POST   | `/api/auth/logout`   | Clears session cookie                |
| GET    | `/api/auth/me`       | Returns current user info            |

### Records
| Method | Endpoint               | Notes                                      |
|--------|------------------------|--------------------------------------------|
| GET    | `/api/records`         | `?group=P6&debt=1&search=aisha`            |
| POST   | `/api/records`         | Create single record                       |
| PUT    | `/api/records/:id`     | Update record                              |
| DELETE | `/api/records/:id`     | Delete record                              |

### Upload (Feature A)
| Method | Endpoint      | Body                           |
|--------|---------------|--------------------------------|
| POST   | `/api/upload` | `multipart/form-data` file=CSV/XLSX |

### SMS
| Method | Endpoint                | Notes                                    |
|--------|-------------------------|------------------------------------------|
| POST   | `/api/sms/status-alert` | `{ recordIds: [1,2,3] }` — Feature B    |
| POST   | `/api/sms/debt-blast`   | `{ customTemplate?, groupFilter? }` — Feature C |
| POST   | `/api/sms/callback`     | Gateway DSR webhook — no auth — Feature D |
| GET    | `/api/sms/logs`         | `?limit=50&offset=0`                     |
| GET    | `/api/sms/stats`        | Totals by status                         |

---

## SMS Gateway Setup

### EgoSMS (Uganda)
1. Register at https://www.egosms.co
2. Set in `.env`:
   ```env
   SMS_PROVIDER=egosms
   SMS_API_KEY=your_username
   SMS_API_SECRET=your_password
   SMS_SENDER_ID=YOURNAME
   ```
3. Configure DSR callback URL in EgoSMS dashboard:
   `https://yourdomain.com/api/sms/callback`

### Africa's Talking
1. Register at https://africastalking.com
2. Set in `.env`:
   ```env
   SMS_PROVIDER=africastalking
   AT_USERNAME=your_username
   SMS_API_KEY=your_api_key
   ```

---

## CSV / Excel Import Format

| Name           | Group    | Phone          | Balance |
|----------------|----------|----------------|---------|
| Aisha Nakato   | P.6 East | +256701234567  | 150000  |
| Brian Ssemanda | P.5 West | 0772345678     | 0       |

- Phone formats accepted: `+256XXXXXXXXX`, `07XXXXXXXX`, `256XXXXXXXXX`
- Balance: any number (UGX). Empty = 0.
- Group: any text — used for filtering (class, level, building block, etc.)
- Download template from the app Import page.

---

## SMS Message Template

**Default (debt alert):**
```
[INSTITUTION_NAME] Notice: Hello, the status of {{full_name}} requires
attention. Balance: {{current_balance}} UGX. Please clear immediately.
```

**Custom template variables:**
```
{{full_name}}          → Record's full name
{{current_balance}}    → Balance in UGX
{{institution_name}}   → Your institution name
```

---

## Migrating to PostgreSQL

1. In `backend/db/index.js`, replace `better-sqlite3` with `pg`:
```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

2. Change `?` placeholders to `$1, $2, $3…` in all SQL strings.

3. Replace `AUTOINCREMENT` with `SERIAL` in schema.sql.

4. Replace `CURRENT_TIMESTAMP` with `NOW()`.

---

## Security Measures
- **Passwords**: bcrypt (cost=12) — never stored in plain text
- **Sessions**: 32-byte random hex token, HttpOnly cookie, 8h TTL
- **Tenant isolation**: Every query is scoped by `user_id` — cross-tenant access is impossible
- **Input sanitization**: All strings stripped of HTML/control characters before DB insert
- **Phone normalization**: Uganda numbers normalized to E.164 (+256XXXXXXXXX)
- **Security headers**: CSP, X-Frame-Options, X-Content-Type-Options on all responses
- **File upload**: Type whitelist + 5MB size limit, temp files deleted after parse
- **SMS webhook**: Public endpoint accepts only status updates; cannot modify records

---

## Production Deployment (Ubuntu VPS)

```bash
# Install Node 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
sudo npm install -g pm2

# Deploy app
cd /var/www/alertledger
npm install --production
cp .env.example .env && nano .env   # fill real credentials

# Start
pm2 start server.js --name alertledger
pm2 save
pm2 startup

# Nginx reverse proxy (optional)
sudo apt install nginx
# Configure: proxy_pass http://localhost:3000
```
