# PruVenture Apprentice Chatbot

Recruitment chatbot for the **Pru Life UK PruVenture Apprentice Program**.  
Single-page chat UI + Node.js/Express backend with Google Drive upload, Google Form submission, and email notifications.

---

## Quick Start

```bash
cd pv-apprentice
npm install
# Configure .env (see below)
node server.js
# Open http://localhost:3000
```

---

## Setup Guide

### 1. Google Cloud Service Account (for Drive upload)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. Enable **Google Drive API**: APIs & Services → Library → search "Google Drive API" → Enable.
3. Create a Service Account: IAM & Admin → Service Accounts → Create Service Account.
   - Give it any name (e.g. `pv-apprentice-bot`).
4. Create a JSON key: click the service account → Keys tab → Add Key → JSON → Download.
5. Save the downloaded file as **`service-account.json`** in this project folder.
6. In your Google Drive, create a folder named **"PV Apprentice"** and share it with the service account email (found in the JSON as `client_email`) — give it **Editor** access.
   - Alternatively, leave it and the app will auto-create the folder in the service account's Drive. To see uploads in *your* Drive, share the folder back to your personal account.

### 2. Google Form — Submit URL & Entry IDs

1. Create a Google Form with these fields (short answer for text, multiple choice for options):
   - Full Name, Email Address, Phone Number, Age Range, City/Location,
     Years of Experience, College Graduate, Willingness, CV Filename
2. Click the **⋮ menu → Get pre-filled link**.
   - Fill in dummy values for each field and click **Get Link**.
   - The URL will look like:  
     `https://docs.google.com/forms/d/e/XXXXXX/viewform?entry.123456789=dummy&...`
3. Copy the base submit URL (replace `viewform` with `formResponse`):  
   `https://docs.google.com/forms/d/e/XXXXXX/formResponse`
4. Note each `entry.XXXXXXXXX` ID for each field.
5. Open `server.js` and replace the `entry.ENTRY_NAME`, `entry.ENTRY_EMAIL`, etc. placeholders with the real entry IDs.
6. Set `GOOGLE_FORM_SUBMIT_URL` in `.env` to the `formResponse` URL.

### 3. Gmail App Password (for Nodemailer)

> Gmail requires an **App Password** when 2FA is enabled (recommended).

1. Go to your Google Account → Security → **2-Step Verification** → enable it.
2. Go to Security → **App Passwords** → select app: Mail, device: Other → name it "PV Apprentice Bot".
3. Copy the 16-character password.
4. Set `GMAIL_USER` = your Gmail address and `GMAIL_APP_PASSWORD` = the 16-char password in `.env`.

### 4. Fill in `.env`

```env
GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json
GOOGLE_DRIVE_FOLDER_NAME=PV Apprentice
GMAIL_USER=your_gmail@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
RECRUITER_EMAIL=recruiter@prulifeuk.com
GOOGLE_FORM_SUBMIT_URL=https://docs.google.com/forms/d/e/XXXXXX/formResponse
PORT=3000
```

### 5. Run

```bash
npm install
node server.js
```

Open **http://localhost:3000** in your browser.

---

## File Structure

```
pv-apprentice/
├── index.html          ← Full chatbot frontend (single file)
├── server.js           ← Express backend
├── package.json
├── .env                ← Environment variables (gitignored)
├── .gitignore
├── service-account.json  ← Google service account key (gitignored)
└── README.md
```

---

## Google Form Entry ID Mapping

Open `server.js` and find the `submitToGoogleForm` function. Replace each placeholder:

| Placeholder          | Replace with          |
|----------------------|-----------------------|
| `entry.ENTRY_NAME`        | e.g. `entry.123456789` |
| `entry.ENTRY_EMAIL`       | e.g. `entry.234567890` |
| `entry.ENTRY_PHONE`       | e.g. `entry.345678901` |
| `entry.ENTRY_AGE`         | e.g. `entry.456789012` |
| `entry.ENTRY_CITY`        | e.g. `entry.567890123` |
| `entry.ENTRY_EXPERIENCE`  | e.g. `entry.678901234` |
| `entry.ENTRY_GRADUATE`    | e.g. `entry.789012345` |
| `entry.ENTRY_WILLINGNESS` | e.g. `entry.890123456` |

---

## Eligibility Rules

| Criterion | Pass Condition |
|-----------|---------------|
| Age | 22–40 (not "Other") |
| Experience | Not "More than 3 years" |
| Graduate | "Yes" |

All three must be met. Otherwise, a polite ineligibility message is shown.

---

## Deployment Tips

- Use **[Railway](https://railway.app)**, **Render**, or **Heroku** for easy Node.js hosting.
- Set all `.env` values as environment variables in the platform dashboard.
- Upload `service-account.json` as a secret file or encode it as a base64 env var.
